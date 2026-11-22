CREATE TABLE `training_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`topic` text NOT NULL,
	`summary` text NOT NULL,
	`r2_key` text NOT NULL,
	`source_file` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `training_doc_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doc_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`heading` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `training_docs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `training_doc_chunks_doc_idx` ON `training_doc_chunks` (`doc_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `training_doc_chunks_doc_chunk_uidx` ON `training_doc_chunks` (`doc_id`,`chunk_index`);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS training_doc_chunks_fts USING fts5(
  heading,
  body,
  content='training_doc_chunks',
  content_rowid='id',
  tokenize='trigram'
);
