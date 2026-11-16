-- Migration registrada no Supabase. Rever antes de aplicar em outro ambiente.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('erp-images','erp-images',true,2097152,ARRAY['image/jpeg','image/png','image/webp']) ON CONFLICT(id) DO NOTHING;
