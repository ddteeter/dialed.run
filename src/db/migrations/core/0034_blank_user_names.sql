-- Task 126 (owner, 2026-09-27): dialed.run keeps no name. A runner is their
-- handle; Better Auth's `user.name` column stays (its sign-up needs one) and
-- holds "". Sign-up already sent "", but Google copied the profile's name
-- in, so the ones already stored are cleared. Data only, no schema change.
UPDATE `user` SET `name` = '' WHERE `name` <> '';
