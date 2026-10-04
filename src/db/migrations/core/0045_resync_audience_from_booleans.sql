-- Design 131, PR B (R-129, D-109): the read flip. Data only, no schema
-- change, and idempotent: a second run matches no row.
--
-- PR A writes the audience and the boolean together, so the two can only
-- disagree on a row that code older than A wrote between `migrations apply`
-- and `deploy`, and there the boolean is the truth. Copy it over before any
-- reader depends on the audience. A `groups` row disagrees with its boolean
-- too, but nothing can write `groups` yet, so none exists to be narrowed.
UPDATE `outfit_entries` SET `audience` = CASE WHEN `is_public` = 1 THEN 'runners' ELSE 'private' END
  WHERE `audience` <> CASE WHEN `is_public` = 1 THEN 'runners' ELSE 'private' END;
--> statement-breakpoint
UPDATE `user_profiles` SET `default_audience` = CASE WHEN `share_default` = 1 THEN 'runners' ELSE 'private' END
  WHERE `default_audience` <> CASE WHEN `share_default` = 1 THEN 'runners' ELSE 'private' END;
