DELETE FROM access_tokens
WHERE id NOT IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id
        ORDER BY created_at DESC, id DESC
      ) AS row_number
    FROM access_tokens
  )
  WHERE row_number = 1
);

CREATE UNIQUE INDEX idx_access_tokens_user ON access_tokens(user_id);
