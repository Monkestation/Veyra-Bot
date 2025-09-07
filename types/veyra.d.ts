interface VerifiedFlags {
  [key: string]: string | number | boolean;
}

interface VerificationRequestBody {
  discord_id: string;
  ckey: string;
  verified_flags?: VerifiedFlags;
  verification_method?: string;
}

interface VerificationSuccessResponse {
  message: string;
  discord_id: string;
  ckey: string;
  verified_flags: VerifiedFlags;
}

interface VerificationErrorResponse {
  error: string;
}


interface VerificationGetResponse {
  discord_id: string;
  ckey: string;
  verified_flags: VerifiedFlags;
  verification_method: string;
  verified_by: string;
  created_at: string;
  updated_at: string;
}