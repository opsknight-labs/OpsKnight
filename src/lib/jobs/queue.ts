/** PostgreSQL-backed durable job queue. */
import { Prisma } from '@prisma/client';
import { logger } from '../logger';
import prisma from '../prisma';

const MAX_RETRY_BACKOFF_MS = 15 * 60 * 1000;
const PROCESSING_LEASE_HEARTBEAT_MS = 60 * 1000;

export type JobType = 'ESCALATION' | 'NOTIFICATION' | 'AUTO_UNSNOOZE' | 'SCHEDULED_TASK' | 'STATUS_PAGE_NOTIFICATION';
export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
interface JobPayload { incidentId?: string; stepIndex?: number; eventType?: string; task?: string; [key:string]:unknown; }

export async function scheduleJob(type:JobType,scheduledAt:Date,payload:JobPayload,maxAttempts:number=3):Promise<string>{
  const job=await prisma.backgroundJob.create({data:{type,status:'PENDING',scheduledAt,payload:payload as Prisma.InputJsonObject,maxAttempts}});return job.id;
}
export async function scheduleEscalation(incidentId:string,stepIndex:number,delayMs:number):Promise<string>{return scheduleJob('ESCALATION',new Date(Date.now()+delayMs),{incidentId,stepIndex});}
export async function scheduleStatusPageNotification(incidentId:string,eventType:string):Promise<string>{return scheduleJob('STATUS_PAGE_NOTIFICATION',new Date(),{incidentId,eventType},5);}
export async function scheduleAutoUnsnooze(incidentId:string,snoozedUntil:Date):Promise<string>{return scheduleJob('AUTO_UNSNOOZE',snoozedUntil,{incidentId});}
export async function getPendingJobs(limit:number=50):Promise<unknown[]>{return prisma.backgroundJob.findMany({where:{status:'PENDING',scheduledAt:{lte:new Date()}},orderBy:{scheduledAt:'asc'},take:limit});}

export async function claimPendingJobs(limit:number=50,type?:JobType):Promise<any[]>{
  await prisma.$executeRaw(Prisma.sql`UPDATE "BackgroundJob" SET "status"='FAILED',"error"='Job timed out in PROCESSING state after exceeding maxAttempts',"failedAt"=NOW() WHERE "status"='PROCESSING' AND ("startedAt" IS NULL OR "startedAt"<NOW()-INTERVAL '10 minutes') AND "attempts">="maxAttempts";`).catch(err=>logger.warn('[Queue] Failed to sweep zombie processing jobs',{error:err}));
  const typeFilter=type?Prisma.sql`AND candidate."type"=${type}::"JobType"`:Prisma.empty;
  return prisma.$queryRaw<any[]>(Prisma.sql`
    WITH cte AS (
      SELECT candidate."id" FROM "BackgroundJob" AS candidate
      WHERE (candidate."status"='PENDING' OR (candidate."status"='PROCESSING' AND (candidate."startedAt" IS NULL OR candidate."startedAt"<NOW()-INTERVAL '10 minutes')))
        AND candidate."scheduledAt"<=NOW() AND candidate."attempts"<candidate."maxAttempts" ${typeFilter}
        AND (
          candidate."type"<>'SCHEDULED_TASK'::"JobType"
          OR candidate."payload"->>'task' IS DISTINCT FROM 'EVENT_SIDE_EFFECT'
          OR NOT EXISTS (
            SELECT 1 FROM "BackgroundJob" AS older
            WHERE older."type"='SCHEDULED_TASK'::"JobType" AND older."status" IN ('PENDING','PROCESSING')
              AND older."payload"->>'task'='EVENT_SIDE_EFFECT'
              AND older."payload"->>'incidentId'=candidate."payload"->>'incidentId'
              AND older."payload"->>'lane'=candidate."payload"->>'lane'
              AND older."id"<>candidate."id"
              AND (older."payload"->>'eventOrderAt')::timestamptz < (candidate."payload"->>'eventOrderAt')::timestamptz
          )
        )
      ORDER BY candidate."scheduledAt" ASC,candidate."createdAt" ASC
      FOR UPDATE OF candidate SKIP LOCKED LIMIT ${limit}
    )
    UPDATE "BackgroundJob" SET "status"='PROCESSING',"startedAt"=NOW(),"attempts"="attempts"+1 WHERE "id" IN (SELECT "id" FROM cte) RETURNING *;
  `);
}

export async function markJobProcessing(jobId:string):Promise<void>{await prisma.backgroundJob.update({where:{id:jobId},data:{status:'PROCESSING',startedAt:new Date(),attempts:{increment:1}}});}
export async function markJobCompleted(jobId:string):Promise<void>{await prisma.backgroundJob.update({where:{id:jobId},data:{status:'COMPLETED',completedAt:new Date()}});}
export async function markJobFailed(jobId:string,error:string):Promise<void>{
  const job=await prisma.backgroundJob.findUnique({where:{id:jobId}});if(!job)return;const shouldRetry=job.attempts<job.maxAttempts;
  await prisma.backgroundJob.update({where:{id:jobId},data:{status:shouldRetry?'PENDING':'FAILED',failedAt:shouldRetry?null:new Date(),error:shouldRetry?null:error,scheduledAt:shouldRetry?new Date(Date.now()+Math.min(Math.pow(2,job.attempts)*30000+Math.floor(Math.random()*10000),MAX_RETRY_BACKOFF_MS)):job.scheduledAt}});
}

export async function processJob(job:any):Promise<boolean>{
  let leaseHeartbeat:NodeJS.Timeout|null=null;
  try{
    if(job.status!=='PROCESSING')await markJobProcessing(job.id);
    leaseHeartbeat=setInterval(()=>{void prisma.backgroundJob.updateMany({where:{id:job.id,status:'PROCESSING'},data:{startedAt:new Date()}}).catch(error=>logger.warn('jobs.processing_lease_heartbeat_failed',{jobId:job.id,error:error instanceof Error?error.message:String(error)}));},PROCESSING_LEASE_HEARTBEAT_MS);
    switch(job.type){
      case'ESCALATION':{
        const {executeEscalation}=await import('../escalation');const result=await executeEscalation(job.payload.incidentId,job.payload.stepIndex);const reason=(result.reason||'').toLowerCase();
        const complete=result.escalated||reason.includes('completed')||reason.includes('exhausted')||reason.includes('already in progress')||reason.includes('scheduled')||reason.includes('no escalation policy')||reason.includes('no users to notify')||reason.includes('invalid target')||reason.includes('superseded');
        if(complete){await markJobCompleted(job.id);return true;}await markJobFailed(job.id,result.reason||'Escalation failed');return false;
      }
      case'NOTIFICATION':
        await prisma.backgroundJob.update({where:{id:job.id},data:{status:'CANCELLED',completedAt:new Date(),error:'Superseded by durable per-channel notification intents'}});return true;
      case'STATUS_PAGE_NOTIFICATION':{
        const {notifyStatusPageSubscribers}=await import('../status-page-notifications');const subscriberResult=await notifyStatusPageSubscribers(job.payload.incidentId,job.payload.eventType);if(!subscriberResult.success)throw new Error(`Status page subscriber delivery failed (${subscriberResult.failed})`);
        const incidentForWebhook=await prisma.incident.findUnique({where:{id:job.payload.incidentId},select:{id:true,title:true,status:true,urgency:true,priority:true,visibility:true,serviceId:true,createdAt:true,acknowledgedAt:true,resolvedAt:true,service:{select:{id:true,name:true}}}});
        if(incidentForWebhook?.visibility==='PUBLIC'){
          const {triggerWebhooksForService}=await import('../status-page-webhooks');const eventMap:Record<string,string>={triggered:'incident.created',acknowledged:'incident.acknowledged',resolved:'incident.resolved',snoozed:'incident.snoozed',suppressed:'incident.suppressed',updated:'incident.updated',investigating:'incident.updated'};
          const webhookResult=await triggerWebhooksForService(incidentForWebhook.serviceId,eventMap[job.payload.eventType]||'incident.updated',{id:incidentForWebhook.id,title:incidentForWebhook.title,status:incidentForWebhook.status,urgency:incidentForWebhook.urgency,priority:incidentForWebhook.priority,visibility:incidentForWebhook.visibility,service:incidentForWebhook.service,createdAt:incidentForWebhook.createdAt.toISOString(),acknowledgedAt:incidentForWebhook.acknowledgedAt?.toISOString()||null,resolvedAt:incidentForWebhook.resolvedAt?.toISOString()||null});
          if(webhookResult.failed>0)throw new Error(`Status page webhook delivery failed (${webhookResult.failed})`);
        }
        await markJobCompleted(job.id);return true;
      }
      case'SCHEDULED_TASK':{
        if(job.payload?.task!=='EVENT_SIDE_EFFECT'){await prisma.backgroundJob.update({where:{id:job.id},data:{status:'FAILED',failedAt:new Date(),error:`Unknown scheduled task: ${job.payload?.task||'missing task'}`}});return false;}
        const {processEventSideEffect}=await import('../event-side-effects');await processEventSideEffect(job.payload);await markJobCompleted(job.id);return true;
      }
      case'AUTO_UNSNOOZE':{
        const {processAutoUnsnoozeIncidentInternal}=await import('../unsnooze');const result=await processAutoUnsnoozeIncidentInternal(job.payload.incidentId);
        if(result.outcome==='changed'){await markJobCompleted(job.id);return true;}
        if(result.outcome==='not_due'){await prisma.backgroundJob.update({where:{id:job.id},data:{status:'PENDING',attempts:0,scheduledAt:result.snoozedUntil,startedAt:null}});return false;}
        await prisma.backgroundJob.update({where:{id:job.id},data:{status:'CANCELLED',completedAt:new Date()}});return false;
      }
      default:await markJobFailed(job.id,`Unknown job type: ${job.type}`);return false;
    }
  }catch(error){await markJobFailed(job.id,error instanceof Error?error.message:'Unknown error');return false;}finally{if(leaseHeartbeat)clearInterval(leaseHeartbeat);}
}

export async function processPendingJobs(limit:number=50,concurrency:number=10):Promise<{processed:number;failed:number;total:number}>{const pendingJobs=await claimPendingJobs(limit);let processed=0,failed=0;for(let i=0;i<pendingJobs.length;i+=concurrency){const results=await Promise.allSettled(pendingJobs.slice(i,i+concurrency).map(job=>processJob(job)));for(const result of results){if(result.status==='fulfilled'&&result.value)processed++;else failed++;}}return{processed,failed,total:pendingJobs.length};}
export async function processPendingJobsByType(type:JobType,limit:number=50,concurrency:number=10):Promise<{processed:number;failed:number;total:number}>{const pendingJobs=await claimPendingJobs(limit,type);let processed=0,failed=0;for(let i=0;i<pendingJobs.length;i+=concurrency){const results=await Promise.allSettled(pendingJobs.slice(i,i+concurrency).map(job=>processJob(job)));for(const result of results){if(result.status==='fulfilled'&&result.value)processed++;else failed++;}}return{processed,failed,total:pendingJobs.length};}
export async function cleanupOldJobs(olderThanDays:number=7):Promise<number>{const cutoffDate=new Date();cutoffDate.setDate(cutoffDate.getDate()-olderThanDays);const result=await prisma.backgroundJob.deleteMany({where:{OR:[{status:{in:['COMPLETED','CANCELLED']},completedAt:{lte:cutoffDate}},{status:'FAILED',failedAt:{lte:cutoffDate}}]}});return result.count;}
export async function getJobStats():Promise<{pending:number;processing:number;completed:number;failed:number}>{const[pending,processing,completed,failed]=await Promise.all([prisma.backgroundJob.count({where:{status:'PENDING'}}),prisma.backgroundJob.count({where:{status:'PROCESSING'}}),prisma.backgroundJob.count({where:{status:'COMPLETED'}}),prisma.backgroundJob.count({where:{status:'FAILED'}})]);return{pending,processing,completed,failed};}
