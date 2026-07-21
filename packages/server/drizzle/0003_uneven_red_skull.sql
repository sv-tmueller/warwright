CREATE TABLE "cosmetic_ownership" (
	"user_id" uuid NOT NULL,
	"cosmetic_id" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_kind" text NOT NULL,
	CONSTRAINT "cosmetic_ownership_user_id_cosmetic_id_pk" PRIMARY KEY("user_id","cosmetic_id")
);
--> statement-breakpoint
CREATE TABLE "cosmetic_selection" (
	"user_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"cosmetic_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cosmetic_selection_user_id_slot_pk" PRIMARY KEY("user_id","slot")
);
--> statement-breakpoint
ALTER TABLE "cosmetic_ownership" ADD CONSTRAINT "cosmetic_ownership_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cosmetic_selection" ADD CONSTRAINT "cosmetic_selection_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;