-- The daily cap default drops from 8 to 2: a tracker is read to see how an
-- issue moved, and a busy day yields 26 articles that bury the shape of it.
--
-- SQLite cannot alter a column default in place, and rewriting the table would
-- risk the timelines for a default that only affects rows not yet created.
-- validateTracker() applies the new default for anything the API creates, so
-- this only needs to catch trackers made before that changed — and only those
-- still sitting on the old default, never a number the user chose.
UPDATE trackers SET per_day = 2 WHERE per_day = 8;
