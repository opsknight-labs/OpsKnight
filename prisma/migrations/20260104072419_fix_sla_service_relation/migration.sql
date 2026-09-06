-- AddForeignKey
ALTER TABLE "SLADefinition" ADD CONSTRAINT "SLADefinition_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
