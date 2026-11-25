CREATE TABLE `book_tags` (
	`book_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`book_id`, `tag`)
);
--> statement-breakpoint
CREATE INDEX `book_tags_tag_idx` ON `book_tags` (`tag`);--> statement-breakpoint
ALTER TABLE `books` ADD `intro` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `books` ADD `cover_key` text;--> statement-breakpoint
ALTER TABLE `books` ADD `cover_type` text;