CREATE TABLE `exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name_ko` text NOT NULL,
	`kind` text NOT NULL,
	`laterality` text NOT NULL,
	`region` text NOT NULL,
	`isolation` integer DEFAULT 0 NOT NULL,
	`cue` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_slug_unique` ON `exercises` (`slug`);--> statement-breakpoint
CREATE INDEX `exercises_region_idx` ON `exercises` (`region`);--> statement-breakpoint
CREATE INDEX `exercises_laterality_idx` ON `exercises` (`laterality`);--> statement-breakpoint
ALTER TABLE `workout_logs` ADD `mode` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `workout_logs` ADD `rounds` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
INSERT INTO `exercises` (`slug`, `name_ko`, `kind`, `laterality`, `region`, `isolation`, `cue`) VALUES
	('db-row', '덤벨 로우', 'strength', 'unilateral', 'upper', 0, '약한 쪽부터. 팔꿈치로 끌어올리세요.'),
	('cable-row-one', '원암 케이블 로우', 'strength', 'unilateral', 'upper', 0, '몸통이 돌아가지 않게 고정하세요.'),
	('db-press', '덤벨 프레스', 'strength', 'unilateral', 'upper', 0, '좌우 횟수를 같게 맞추세요.'),
	('lateral-raise', '덤벨 사이드 레터럴', 'strength', 'unilateral', 'upper', 1, '어깨만 들어 올리세요.'),
	('split-squat', '스플릿 스쿼트', 'strength', 'unilateral', 'lower', 0, '약한 다리부터. 무릎이 발끝 밖으로 나가지 않게.'),
	('db-rdl-one', '원레그 루마니안 데드리프트', 'strength', 'unilateral', 'lower', 0, '골반을 뒤로 밀며 균형을 잡으세요.'),
	('step-up', '스텝업', 'strength', 'unilateral', 'lower', 0, '발바닥 전체로 밀어 올리세요.'),
	('squat', '스쿼트', 'strength', 'bilateral', 'lower', 0, '무릎·발끝 방향을 맞추세요.'),
	('push-up', '푸시업', 'strength', 'bilateral', 'upper', 0, '코어를 조이고 가슴을 바닥으로.'),
	('inverted-row', '인버티드 로우', 'strength', 'bilateral', 'upper', 0, '몸통을 곧게 유지하세요.'),
	('deadlift', '데드리프트', 'strength', 'bilateral', 'full', 0, '허리가 둥글어지지 않게.'),
	('plank', '플랭크', 'strength', 'bilateral', 'core', 1, '엉덩이가 뜨거나 처지지 않게.'),
	('side-plank', '사이드 플랭크', 'strength', 'unilateral', 'core', 1, '약한 쪽부터 같은 시간만큼.'),
	('leg-curl', '레그컬', 'strength', 'unilateral', 'lower', 1, '햄스트링만 접으세요.'),
	('leg-extension', '레그 익스텐션', 'strength', 'unilateral', 'lower', 1, '무릎만 펴고 반동은 쓰지 마세요.'),
	('cable-fly', '케이블 플라이', 'strength', 'unilateral', 'upper', 1, '가슴이 모이는 느낌으로.'),
	('jumping-jack', '점핑잭', 'cardio', 'bilateral', 'full', 0, '호흡을 끊지 마세요.'),
	('mountain-climber', '마운틴 클라이머', 'cardio', 'bilateral', 'full', 0, '허리가 꺾이지 않게.');
