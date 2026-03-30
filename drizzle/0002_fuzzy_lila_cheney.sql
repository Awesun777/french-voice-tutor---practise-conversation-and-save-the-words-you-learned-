ALTER TABLE `quiz_sessions` MODIFY COLUMN `bucketStart` varchar(100);--> statement-breakpoint
ALTER TABLE `quiz_sessions` MODIFY COLUMN `bucketEnd` varchar(100);--> statement-breakpoint
ALTER TABLE `vocab_entries` MODIFY COLUMN `dateKey` varchar(100) NOT NULL;