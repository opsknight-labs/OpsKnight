#!/usr/bin/env python3
"""Production-browser certification using only owned disposable local fixtures.
Run with --build; requires Docker, OpenSSL and installed Playwright browsers.
A cached bundle from another HTTPS origin is never reused.
No live IdP/provider calls, environment validation bypass, or production writes.
"""
import os,json,subprocess,secrets,time,pathlib,shutil,ssl,urllib.request,socket,tempfile,argparse,hashlib
from urllib.parse import quote
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--postgres-bin',type=pathlib.Path,help='Optional local PostgreSQL bin directory; creates and removes an isolated native cluster instead of Docker')
parser.add_argument('--build',action='store_true',help='Build the production bundle using generated local fixture secrets')
args=parser.parse_args()
if not args.build: parser.error("--build is required because the disposable HTTPS origin changes for each run")
root=pathlib.Path(__file__).resolve().parents[1]
name='opsknight-sso-browser-cert-'+secrets.token_hex(4)
image=os.environ.get('SSO_CERT_POSTGRES_IMAGE','postgres:16')
password=secrets.token_hex(24);server=proxy=None;created=False
with socket.socket() as allocator:
 allocator.bind(('127.0.0.1',0)); host_port=allocator.getsockname()[1]
with socket.socket() as allocator:
 allocator.bind(('127.0.0.1',0)); web_port=allocator.getsockname()[1]
with socket.socket() as allocator:
 allocator.bind(('127.0.0.1',0)); tls_port=allocator.getsockname()[1]
origin=f'https://localhost:{tls_port}'
fixture=tempfile.TemporaryDirectory(prefix='opsknight-auth-browser-')
fixture_path=pathlib.Path(fixture.name)
serverlog=open(fixture_path/'server.log','w');proxylog=open(fixture_path/'proxy.log','w')
try:
 if args.postgres_bin:
  pg_bin=args.postgres_bin.resolve()
  for executable in ['initdb','pg_ctl','postgres']:
   if not (pg_bin/executable).is_file():raise RuntimeError('Local PostgreSQL bin directory is incomplete')
  data_dir=fixture_path/'data'; password_file=fixture_path/'postgres-password'
  password_file.write_text(password);password_file.chmod(0o600)
  subprocess.run([str(pg_bin/'initdb'),'-D',str(data_dir),'-U','certifier','--pwfile',str(password_file),'-A','scram-sha-256','--encoding=UTF8','--locale=C'],check=True,stdout=subprocess.DEVNULL)
  password_file.unlink()
  subprocess.run([str(pg_bin/'pg_ctl'),'-D',str(data_dir),'-l',str(fixture_path/'postgres.log'),'-o',f'-h 127.0.0.1 -p {host_port} -k /tmp -c max_connections=30 -c shared_buffers=64MB -c timezone=UTC','-w','start'],check=True,stdout=subprocess.DEVNULL)
  created=True;port=str(host_port)
 else:
  subprocess.run(['docker','run','-d','--name',name,'--memory','768m','--cpus','2','-p',f'127.0.0.1:{host_port}:5432','-e','POSTGRES_USER=certifier','-e','POSTGRES_PASSWORD='+password,'-e','POSTGRES_DB=enterprise_sso_test',image],check=True,stdout=subprocess.DEVNULL)
  created=True
  for _ in range(100):
   if subprocess.run(['docker','exec',name,'pg_isready','-U','certifier','-d','enterprise_sso_test'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
   time.sleep(.3)
  else:raise RuntimeError('Isolated PostgreSQL not ready')
  port=json.loads(subprocess.check_output(['docker','inspect',name]))[0]['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
 url=f'postgresql://certifier:{quote(password)}@127.0.0.1:{port}/enterprise_sso_test?schema=public&connection_limit=10'
 env=os.environ.copy();env.update(DATABASE_URL=url,DIRECT_URL=url,NEXTAUTH_SECRET=secrets.token_hex(32),API_KEY_SECRET=secrets.token_hex(32),ENCRYPTION_KEY=secrets.token_hex(32),NEXTAUTH_URL=origin,NEXT_PUBLIC_APP_URL=origin,AUTH_RECOVERY_ORIGIN=origin,NODE_ENV='production',OPSKNIGHT_PROCESS_ROLE='web',TRUST_PROXY_HEADERS='true',HOSTNAME='127.0.0.1',PORT=str(web_port),LOG_LEVEL='error')
 for key in ['SKIP_ENV_VALIDATION','ALLOW_INSECURE_SECRETS']:env.pop(key,None)
 if args.postgres_bin:
  bootstrap_env={**env,'DATABASE_URL':url.replace('/enterprise_sso_test','/postgres')}
  subprocess.run(['node','-e',"const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.$executeRawUnsafe('CREATE DATABASE enterprise_sso_test').catch(e=>{console.error(e.code||e.name);process.exitCode=1}).finally(()=>p.$disconnect());"],cwd=root,env=bootstrap_env,check=True)

 subprocess.run(['npx','prisma','migrate','deploy'],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
 subprocess.run(['node','scripts/prepare-authentication-diagnostics.cjs'],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
 seed=r'''const {PrismaClient}=require('@prisma/client');const bcrypt=require('bcryptjs');const p=new PrismaClient();(async()=>{
await p.systemSettings.create({data:{id:'default',appUrl:'https://localhost:32615'}});
await p.authenticationPolicy.create({data:{id:'default',mode:'PASSWORD_ONLY',legacySnapshot:{}}});
await p.user.create({data:{id:'browser-password-certifier',email:'browser-certifier@example.test',name:'Browser Certifier',role:'ADMIN',status:'ACTIVE',passwordHash:await bcrypt.hash('Local certification browser passphrase October 2026',12)}});
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>p.$disconnect());'''
 seed=seed.replace('https://localhost:32615',origin)
 subprocess.run(['node','-e',seed],cwd=root,env=env,check=True)
 if args.build: subprocess.run(['npm','run','build'],cwd=root,env=env,check=True)
 shutil.copytree(root/'public',root/'.next/standalone/public',dirs_exist_ok=True)
 shutil.copytree(root/'.next/static',root/'.next/standalone/.next/static',dirs_exist_ok=True)
 subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(fixture_path/'key.pem'),'-out',str(fixture_path/'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 proxy_source = """const https=require('node:https'),http=require('node:http'),fs=require('node:fs');
const server=https.createServer({key:fs.readFileSync(process.env.SSO_CERT_TLS_KEY),cert:fs.readFileSync(process.env.SSO_CERT_TLS_CERT)},(req,res)=>{
const upstream=http.request({hostname:'127.0.0.1',port:32616,path:req.url,method:req.method,headers:{...req.headers,host:'localhost:32615','x-forwarded-host':'localhost:32615','x-forwarded-proto':'https','x-forwarded-for':'127.0.0.1'}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Fixture unavailable');});req.pipe(upstream);});server.listen(32615,'127.0.0.1');"""
 (fixture_path/'proxy.cjs').write_text(proxy_source.replace('32616',str(web_port)).replace('32615',str(tls_port)))
 env.update(SSO_CERT_TLS_KEY=str(fixture_path/'key.pem'),SSO_CERT_TLS_CERT=str(fixture_path/'cert.pem'))
 server=subprocess.Popen(['node','.next/standalone/server.js'],cwd=root,env=env,stdout=serverlog,stderr=subprocess.STDOUT)
 proxy=subprocess.Popen(['node',str(fixture_path/'proxy.cjs')],cwd=root,env=env,stdout=proxylog,stderr=subprocess.STDOUT)
 ready=False
 for attempt in range(3):
  for _ in range(40):
   if server.poll() is not None or proxy.poll() is not None:break
   try:
    with urllib.request.urlopen(origin+'/login',context=ssl._create_unverified_context(),timeout=2) as response:
     if response.status==200:ready=True;break
   except Exception:time.sleep(.5)
  if ready:break
  # Startup instrumentation can retain a rejected connection promise after a transient
  # Docker port-forward failure. A bounded restart models the deployment supervisor.
  server.terminate()
  try:server.wait(timeout=10)
  except subprocess.TimeoutExpired:server.kill();server.wait()
  if attempt < 2:
   if args.postgres_bin:subprocess.run([str(pg_bin/'pg_ctl'),'-D',str(data_dir),'status'],check=True,stdout=subprocess.DEVNULL)
   else:subprocess.run(['docker','exec',name,'pg_isready','-U','certifier','-d','enterprise_sso_test'],check=True,stdout=subprocess.DEVNULL)
   server=subprocess.Popen(['node','.next/standalone/server.js'],cwd=root,env=env,stdout=serverlog,stderr=subprocess.STDOUT)
 if not ready:raise RuntimeError('Production fixture not ready after bounded startup retries')
 env.update(SSO_E2E_BASE_URL=origin,SSO_E2E_ADMIN_EMAIL='browser-certifier@example.test',SSO_E2E_ADMIN_PASSWORD='Local certification browser passphrase October 2026',SSO_E2E_ALLOW_SELF_SIGNED='1',SSO_E2E_PASSWORD_RECOVERY='1',SSO_E2E_POSTGRES_CONTAINER=name,SSO_E2E_DIAGNOSTICS_CAPTURE_DIR=os.environ.get('SSO_CERT_CAPTURE_DIR',str(fixture_path/'captures')))
 if args.postgres_bin:
  env.pop('SSO_E2E_POSTGRES_CONTAINER',None);env.update(SSO_E2E_PG_CTL=str(pg_bin/'pg_ctl'),SSO_E2E_PG_DATA=str(data_dir))
 pathlib.Path(env['SSO_E2E_DIAGNOSTICS_CAPTURE_DIR']).mkdir(exist_ok=True)
 for key in ['SSO_E2E_DELIVERY_HISTORY','SSO_E2E_READINESS_PREVIEW']:env.pop(key,None)
 env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(fixture_path/'results.json')
 result=subprocess.run(['npx','playwright','test','-c','playwright.enterprise-sso.config.ts','--reporter=list,json'],cwd=root,env=env)
 if result.returncode == 0:
  sources=['src/lib/auth-control/emergency-password.ts','src/lib/auth-control/emergency.ts','src/lib/auth-control/emergency-management.ts','src/lib/auth-control/dashboard.ts','src/lib/notification-control-plane.ts','src/lib/notification-provider-feedback.ts','src/components/auth/EmergencyLogin.tsx','src/components/settings/AuthenticationConsole.tsx','src/app/api/auth/emergency/route.ts','src/app/api/auth/control/route.ts','tests/e2e/enterprise-authentication.spec.ts','scripts/certify-enterprise-authentication-browser.py']
  sources += [str(path.relative_to(root)) for path in sorted((root/'src/components/settings/authentication').glob('*.tsx'))]
  sources += ['src/lib/auth-control/diagnostic-contract.ts','src/lib/auth-control/diagnostic-cursor.ts','src/lib/auth-control/diagnostic-queries.ts','src/app/api/auth/control/diagnostics/route.ts']
  stats=json.loads((fixture_path/'results.json').read_text())['stats']
  report={'testStats':stats,'measuredAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'scope':'Disposable local production HTTPS web instance and PostgreSQL; virtual hardware key; no live identity or email provider','browsers':['chromium','firefox','webkit'],'passwordRecovery':True,'oneTimeDisplay':True,'passwordRotationRevokesOldSession':True,'restrictedCookie':True,'reauthenticationPreservesHttpExpiry':True,'databaseRestartDuringChromiumRecovery':True,'responsiveViewports':[320,390,768,1366,1920],'accessibility':'axe WCAG 2 A/AA and 2.1 AA on provider workspace','physicalKeyCertification':False,'sourceHashes':{path:hashlib.sha256((root/path).read_bytes()).hexdigest() for path in sources}}
  output=root/'plans/certification/enterprise-sso-2.1-password-browser.json';output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n')
 raise SystemExit(result.returncode)
finally:
 for proc in [proxy,server]:
  if proc:
   proc.terminate()
   try:proc.wait(timeout=15)
   except subprocess.TimeoutExpired:proc.kill();proc.wait()
 if created:
  if args.postgres_bin:subprocess.run([str(pg_bin/'pg_ctl'),'-D',str(data_dir),'-m','immediate','-w','stop'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  else:subprocess.run(['docker','rm','-f','-v',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 serverlog.close();proxylog.close()
 fixture.cleanup()
 print('Owned browser fixture processes and isolated PostgreSQL removed.')
