CREATE VIRTUAL TABLE IF NOT EXISTS foods_fts USING fts5(
  food_name,
  content='foods',
  content_rowid='id',
  tokenize='trigram'
);

INSERT INTO foods_fts(foods_fts) VALUES('rebuild');
