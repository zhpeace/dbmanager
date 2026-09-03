import { redisKeyPattern } from "../redisPattern"

describe("redisKeyPattern", () => {
  it("returns * for empty/whitespace input", () => {
    expect(redisKeyPattern("")).toBe("*")
    expect(redisKeyPattern("   ")).toBe("*")
  })

  it("wraps plain text into a substring (contains) match", () => {
    expect(redisKeyPattern("user")).toBe("*user*")
    expect(redisKeyPattern("hibernate.com")).toBe("*hibernate.com*")
  })

  it("passes through inputs that already contain glob metacharacters", () => {
    expect(redisKeyPattern("user:*")).toBe("user:*")
    expect(redisKeyPattern("*:error")).toBe("*:error")
    expect(redisKeyPattern("h[ae]llo?")).toBe("h[ae]llo?")
  })
})
