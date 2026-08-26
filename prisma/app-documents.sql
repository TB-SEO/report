CREATE TABLE IF NOT EXISTS "app_documents" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "app_documents_pkey" PRIMARY KEY ("id")
);

GRANT ALL ON TABLE "app_documents" TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
