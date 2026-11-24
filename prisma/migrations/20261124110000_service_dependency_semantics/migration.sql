-- Edge semantics for the service graph: whether a dependency is hard or soft, an operator note and an
-- optional criticality. Existing edges are HARD, which is how they have always been treated.
CREATE TYPE "DependencyType" AS ENUM ('HARD', 'SOFT');
CREATE TYPE "DependencyCriticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

ALTER TABLE "ServiceDependency"
ADD COLUMN "dependencyType" "DependencyType" NOT NULL DEFAULT 'HARD',
ADD COLUMN "note" VARCHAR(500),
ADD COLUMN "criticality" "DependencyCriticality";
