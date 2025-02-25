-- Add kindle_email column to user_data table
ALTER TABLE public.user_data
ADD COLUMN kindle_email text,
ADD COLUMN kindle_configured boolean DEFAULT false,
ADD COLUMN kindle_verification_otp text,
ADD COLUMN kindle_verification_expires timestamptz;

-- Add comments to explain the columns
COMMENT ON COLUMN public.user_data.kindle_email IS 'Email address for sending books to Kindle device';
COMMENT ON COLUMN public.user_data.kindle_configured IS 'Whether the Kindle email has been verified';
COMMENT ON COLUMN public.user_data.kindle_verification_otp IS 'OTP for verifying Kindle email';
COMMENT ON COLUMN public.user_data.kindle_verification_expires IS 'Expiration time for the Kindle verification OTP'; 