\set ON_ERROR_STOP on

BEGIN;

INSERT INTO "User" (
  "id",
  "authProvider",
  "providerUserId",
  "userName",
  "lastLoginAt",
  "updatedAt"
) VALUES
  (
    '00000000-0000-4000-8000-000000000101',
    'ANONYMOUS',
    'skill-schema-user-1',
    'skill-schema-user-1',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    'ANONYMOUS',
    'skill-schema-user-2',
    'skill-schema-user-2',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );

INSERT INTO "Skill" (
  "id",
  "name",
  "ownerId",
  "title",
  "description",
  "category",
  "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000201',
  'schema-test-skill',
  '00000000-0000-4000-8000-000000000101',
  'Schema test',
  'Constraint fixture',
  'development',
  CURRENT_TIMESTAMP
);

DO $$
BEGIN
  BEGIN
    INSERT INTO "Skill" (
      "id",
      "name",
      "ownerId",
      "title",
      "description",
      "category",
      "updatedAt"
    ) VALUES (
      '00000000-0000-4000-8000-000000000202',
      'schema-test-skill',
      '00000000-0000-4000-8000-000000000102',
      'Duplicate',
      'Must fail',
      'development',
      CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'expected global Skill name uniqueness violation';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO "Skill" (
      "id",
      "name",
      "ownerId",
      "title",
      "description",
      "category",
      "updatedAt"
    ) VALUES (
      '00000000-0000-4000-8000-000000000203',
      'Invalid_Name',
      '00000000-0000-4000-8000-000000000102',
      'Invalid',
      'Must fail',
      'development',
      CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'expected lowercase Skill name check violation';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$$;

INSERT INTO "UserAgentSkill" (
  "id",
  "userId",
  "skillId",
  "marketSkillId",
  "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000101',
  'legacy-schema-test-a',
  '00000000-0000-4000-8000-000000000201',
  CURRENT_TIMESTAMP
);

DO $$
BEGIN
  BEGIN
    INSERT INTO "UserAgentSkill" (
      "id",
      "userId",
      "skillId",
      "marketSkillId",
      "updatedAt"
    ) VALUES (
      '00000000-0000-4000-8000-000000000302',
      '00000000-0000-4000-8000-000000000101',
      'legacy-schema-test-b',
      '00000000-0000-4000-8000-000000000201',
      CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'expected one add row per user and market Skill';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    DELETE FROM "Skill" WHERE "id" = '00000000-0000-4000-8000-000000000201';
    RAISE EXCEPTION 'expected added Skill deletion to be restricted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END
$$;

INSERT INTO "Skill" (
  "id",
  "name",
  "ownerId",
  "title",
  "description",
  "category",
  "updatedAt"
) VALUES
  (
    '00000000-0000-4000-8000-000000000204',
    'review-retained-skill',
    '00000000-0000-4000-8000-000000000101',
    'Review retained',
    'Review deletion boundary fixture',
    'development',
    CURRENT_TIMESTAMP
  ),
  (
    '00000000-0000-4000-8000-000000000205',
    'audit-snapshot-skill',
    '00000000-0000-4000-8000-000000000101',
    'Audit snapshot',
    'Tool audit deletion boundary fixture',
    'development',
    CURRENT_TIMESTAMP
  );

INSERT INTO "SkillReview" (
  "id",
  "skillId",
  "reviewer",
  "decision",
  "packageSha256"
) VALUES (
  '00000000-0000-4000-8000-000000000401',
  '00000000-0000-4000-8000-000000000204',
  'root',
  'APPROVED',
  repeat('a', 64)
);

DO $$
BEGIN
  BEGIN
    DELETE FROM "Skill" WHERE "id" = '00000000-0000-4000-8000-000000000204';
    RAISE EXCEPTION 'expected reviewed Skill deletion to be restricted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END
$$;

INSERT INTO "AgentThread" (
  "id",
  "userId",
  "title",
  "modelId",
  "provider",
  "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000101',
  'Schema fixture',
  'mock',
  'mock',
  CURRENT_TIMESTAMP
);

INSERT INTO "AgentRun" (
  "id",
  "threadId",
  "userId",
  "input",
  "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000502',
  '00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000101',
  'fixture',
  CURRENT_TIMESTAMP
);

INSERT INTO "AgentToolCall" (
  "id",
  "runId",
  "toolCallId",
  "toolName",
  "args",
  "skillId",
  "skillName",
  "packageSha256"
) VALUES (
  '00000000-0000-4000-8000-000000000503',
  '00000000-0000-4000-8000-000000000502',
  'tool-call-1',
  'shell',
  '{}'::jsonb,
  '00000000-0000-4000-8000-000000000205',
  'audit-snapshot-skill',
  repeat('b', 64)
);

INSERT INTO "UserFile" (
  "id",
  "userId",
  "runId",
  "sourceToolCallId",
  "direction",
  "status",
  "name",
  "objectKey",
  "sizeBytes",
  "updatedAt"
) VALUES (
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000502',
  '00000000-0000-4000-8000-000000000503',
  'OUTPUT',
  'AVAILABLE',
  'result.txt',
  'user-files/schema-fixture/result.txt',
  12,
  CURRENT_TIMESTAMP
);

DELETE FROM "Skill" WHERE "id" = '00000000-0000-4000-8000-000000000205';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AgentToolCall"
    WHERE "id" = '00000000-0000-4000-8000-000000000503'
      AND (
        "skillId" IS NOT NULL
        OR "skillName" <> 'audit-snapshot-skill'
        OR "packageSha256" <> repeat('b', 64)
      )
  ) THEN
    RAISE EXCEPTION 'Skill deletion must clear only the FK and preserve audit snapshots';
  END IF;
END
$$;

DELETE FROM "AgentThread" WHERE "id" = '00000000-0000-4000-8000-000000000501';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "UserFile"
    WHERE "id" = '00000000-0000-4000-8000-000000000601'
      AND "runId" IS NULL
      AND "sourceToolCallId" IS NULL
  ) THEN
    RAISE EXCEPTION 'User files must survive thread, Run and tool-call deletion';
  END IF;
END
$$;

ROLLBACK;
