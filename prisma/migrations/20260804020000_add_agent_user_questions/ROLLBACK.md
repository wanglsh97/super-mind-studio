# Rollback: add_agent_user_questions

This migration adds durable Agent question records and the `WAITING_FOR_USER` enum value.

PostgreSQL enum values cannot be safely removed in place. To roll back application behavior, disable the `ask_user_question` tool and UI while retaining the enum value and data. A destructive schema rollback requires a separately reviewed migration after all dependent rows have been archived or deleted.
