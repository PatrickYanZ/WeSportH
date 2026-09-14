PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'coach', 'member')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE coach_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialty TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  experience INTEGER NOT NULL DEFAULT 0 CHECK (experience >= 0 AND experience <= 60)
);

CREATE TABLE slots (
  id TEXT PRIMARY KEY,
  coach_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_date TEXT NOT NULL,
  slot_time TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 20),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (coach_id, slot_date, slot_time)
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE RESTRICT,
  member_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'completed', 'cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_role_status ON users(role, status);
CREATE INDEX idx_slots_coach_date ON slots(coach_id, slot_date, slot_time);
CREATE INDEX idx_bookings_slot_status ON bookings(slot_id, status);
CREATE INDEX idx_bookings_member_status ON bookings(member_id, status);
CREATE INDEX idx_sessions_user_expiry ON sessions(user_id, expires_at);
