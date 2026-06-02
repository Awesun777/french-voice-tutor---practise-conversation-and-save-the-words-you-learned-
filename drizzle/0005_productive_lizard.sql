CREATE TABLE `dict_cache` (
	`term_key` varchar(512) NOT NULL,
	`entry_json` text NOT NULL,
	`created_at` bigint NOT NULL,
	CONSTRAINT `dict_cache_term_key` PRIMARY KEY(`term_key`)
);
