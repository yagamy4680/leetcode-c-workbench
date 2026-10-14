-- Additive upgrade for workspaces created before accepted status and tags.
ALTER TABLE "Problem" ADD COLUMN "accepted" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "Tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "ProblemTag" (
    "problemId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    PRIMARY KEY ("problemId", "tagId"),
    CONSTRAINT "ProblemTag_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProblemTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Tag_name_key" ON "Tag"("name");
CREATE INDEX IF NOT EXISTS "ProblemTag_tagId_problemId_idx" ON "ProblemTag"("tagId", "problemId");
CREATE INDEX IF NOT EXISTS "Problem_accepted_id_idx" ON "Problem"("accepted", "id");
