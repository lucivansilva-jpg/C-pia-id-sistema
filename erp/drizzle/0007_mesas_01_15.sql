-- Cadastro solicitado pelo proprietário: mesas 1 a 15, sem presumir quantidade de lugares.
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('c3c2eda6-90e3-4d0d-b319-e2605259cfa3',1,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT '24137536-ee05-49f3-9f73-ee5b547c5adb','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='c3c2eda6-90e3-4d0d-b319-e2605259cfa3' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('b08f0fe6-b018-43de-b92a-18dca5220945',2,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT 'c4aaf8e2-4175-46a3-891d-1a36a2805856','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='b08f0fe6-b018-43de-b92a-18dca5220945' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('05759b39-e5fa-462f-bf72-f59156ce046c',3,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT '0c538427-ee46-494f-96e1-3ad971319c01','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='05759b39-e5fa-462f-bf72-f59156ce046c' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('e5c9bd0e-4f4b-4897-8155-d1ffc18a9c29',4,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT '306cec27-cb7d-4248-b2ea-74b923624296','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='e5c9bd0e-4f4b-4897-8155-d1ffc18a9c29' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('90e0272e-6416-46db-a072-01e03011e7d4',5,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT '31c620ff-b9ff-4c63-b71d-55a28c7568f6','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='90e0272e-6416-46db-a072-01e03011e7d4' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('d3961bab-8bce-4b48-a5b8-b98abc43d644',6,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT '36322635-cbfe-4627-824c-cdf3aba73a56','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='d3961bab-8bce-4b48-a5b8-b98abc43d644' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('2e1e61cc-a226-4f46-8d67-08889d7afd83',7,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT '300be49d-1fe1-4a6f-b75f-75ee40d2f1fe','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='2e1e61cc-a226-4f46-8d67-08889d7afd83' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('fed2b241-55f6-466b-bebd-1f71c7b714a9',8,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT '73628fe0-03d5-4b47-a8da-7aec10c4ee43','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='fed2b241-55f6-466b-bebd-1f71c7b714a9' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('2fa2455a-811c-465a-9c8c-6ecee36a5217',9,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT 'a838e685-d8fa-4463-ae2c-f7c34833708a','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='2fa2455a-811c-465a-9c8c-6ecee36a5217' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('d31a5b1e-20c2-4954-a404-b5aa25addc2d',10,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT '167504f1-0726-4aa3-88a5-515a588ac7fa','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='d31a5b1e-20c2-4954-a404-b5aa25addc2d' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('25e5601d-41e3-48d4-b7fd-026df678c51d',11,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT '2ca0b72f-8f93-4aab-b2ed-12076e774df7','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='25e5601d-41e3-48d4-b7fd-026df678c51d' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('6b27327b-05e5-40b8-9260-c98a2d24da85',12,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT '700ff7dc-0d7c-4a04-9d78-e46e38b80ff6','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='6b27327b-05e5-40b8-9260-c98a2d24da85' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('189766e1-cf2f-424d-a594-ad76a1e70efa',13,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT '8d3902a5-81f6-4b08-92e5-24461fc6f498','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='189766e1-cf2f-424d-a594-ad76a1e70efa' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('f245458e-5259-4647-ac2f-2fb969ebc982',14,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT '7738f48b-ed04-4f46-9fea-2873a87a5f15','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='f245458e-5259-4647-ac2f-2fb969ebc982' ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO dining_tables(id,number,seats,active,created_at) VALUES('5ec69c32-020a-4765-881b-b8c0b9095e54',15,NULL,1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(number) DO NOTHING;
--> statement-breakpoint
INSERT INTO audit_log(id,actor_id,action,entity_id,created_at) SELECT 'fa2ae1f4-6dc4-4c10-bfed-8a58da7a3f98','migration:mesas_01_15','table.create.owner_requested',id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM dining_tables WHERE id='5ec69c32-020a-4765-881b-b8c0b9095e54' ON CONFLICT(id) DO NOTHING;
