// Unit tests for the shared API error parser.
// These run as plain unit tests (no Worker/D1 needed) because the parser is pure.
import { describe, expect, it } from "vitest";
import { extractErrorMessage, parseError } from "../app/lib/api";

describe("extractErrorMessage", () => {
  it("prefers an explicit server message (HttpError shape)", () => {
    const body = { error: { code: "bad_request", message: "Invalid column_id" } };
    expect(extractErrorMessage(body, 400)).toBe("Invalid column_id");
  });

  it("surfaces the first zod field validation error with its field name", () => {
    const body = {
      issues: [
        { path: ["title"], message: "String must contain at least 1 character(s)" },
      ],
      name: "ZodError",
    };
    expect(extractErrorMessage(body, 400)).toBe("title: String must contain at least 1 character(s)");
  });

  it("falls back to plain English when the body is empty", () => {
    expect(extractErrorMessage(null, 400)).toBe(
      "Could not complete the request (400). Please check the form and try again."
    );
  });

  it("falls back to plain English without a status", () => {
    expect(extractErrorMessage(undefined)).toBe(
      "Could not complete the request. Please check the form and try again."
    );
  });
});

describe("parseError", () => {
  it("uses the message carried on a thrown api error", () => {
    const err: any = new Error("Invalid column_id");
    err.status = 400;
    err.data = { error: { message: "Invalid column_id" } };
    expect(parseError(err)).toBe("Invalid column_id");
  });

  it("parses a thrown error that carries zod issues via .data (as request() builds it)", () => {
    // request() sets err.message = extractErrorMessage(data) before throwing,
    // so a thrown api error already carries the parsed field message. parseError
    // should return that — never revert to a generic "Request failed".
    const data = { issues: [{ path: ["title"], message: "Required" }], name: "ZodError" };
    const err: any = new Error("");
    err.status = 400;
    err.data = data;
    err.message = extractErrorMessage(data, 400);
    expect(parseError(err)).toBe("title: Required");
  });

  it("returns the default fallback for an empty error", () => {
    expect(parseError(null)).toBe(
      "Could not complete the request. Please check the form and try again."
    );
  });
});
