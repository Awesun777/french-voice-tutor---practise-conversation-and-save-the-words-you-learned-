CREATE TABLE `voice_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`transcript` text,
	`summary` text,
	`savedWords` text,
	`startedAt` bigint NOT NULL,
	`endedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `voice_sessions_id` PRIMARY KEY(`id`)
);
