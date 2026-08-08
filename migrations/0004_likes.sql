ALTER TABLE moments ADD COLUMN profile_id INTEGER REFERENCES profiles(id);
ALTER TABLE moments ADD COLUMN likes_count INTEGER NOT NULL DEFAULT 0 CHECK (likes_count >= 0);
CREATE INDEX moments_profile_id ON moments (profile_id);
