# Rollback: reconcile_agent_user_question_status

This data repair changes stale `PENDING` question batches to `CANCELLED` or `INTERRUPTED` when
their owning run is already terminal. Reverting those rows to pending would expose questions that
cannot resume an in-memory Agent loop, so this migration is intentionally not reversed.
