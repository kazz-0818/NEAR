export class NearError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "NearError";
  }
}

export class LineSignatureError extends NearError {
  constructor(message = "Invalid LINE signature") {
    super(message, "LINE_SIGNATURE_INVALID");
  }
}
