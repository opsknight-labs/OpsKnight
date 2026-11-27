-- CreateEnum
CREATE TYPE "WarRoomTeamAutoAdd" AS ENUM ('NONE', 'MANAGERS', 'ALL');

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "warRoomAutoAddTeam" "WarRoomTeamAutoAdd" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "warRoomAutoAddUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

