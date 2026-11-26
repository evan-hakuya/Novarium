ALTER TABLE `books` ADD `genre` text;--> statement-breakpoint
ALTER TABLE `books` ADD `subgenre` text;--> statement-breakpoint
ALTER TABLE `books` ADD `serial_status` text;--> statement-breakpoint
ALTER TABLE `books` ADD `aliases` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `books` ADD `author_en` text;--> statement-breakpoint
ALTER TABLE `books` ADD `source_word_count` integer;--> statement-breakpoint
ALTER TABLE `books` ADD `released` text;--> statement-breakpoint
ALTER TABLE `books` ADD `source_updated_at` integer;--> statement-breakpoint
ALTER TABLE `books` ADD `facets` text;--> statement-breakpoint
ALTER TABLE `books` ADD `mature` integer;--> statement-breakpoint
ALTER TABLE `books` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `books` ADD `also_on` text;