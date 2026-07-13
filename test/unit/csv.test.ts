import { describe, expect, it } from "vitest";
import { parseCsv, CsvTicketSource } from "../../src/server/tickets/csv.ts";
import type { Event } from "../../src/server/db/schema.ts";

describe("parseCsv", () => {
  it("handles quotes, embedded commas/newlines, escaped quotes, CRLF and a BOM", () => {
    const csv = 'a,b,c\r\n1,"two, still two","line\nbreak"\n"quote""inside",5,6\n';
    const rows = parseCsv("﻿" + csv);
    expect(rows).toHaveLength(3);
    expect(rows[1][1]).toBe("two, still two");
    expect(rows[1][2]).toBe("line\nbreak");
    expect(rows[2][0]).toBe('quote"inside');
  });

  it("returns an empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("CsvTicketSource", () => {
  it("maps tolerant headers, normalises email, and synthesises unique keys per order", async () => {
    const csv =
      "Order #,Ticket Type,First Name,Last Name,Email,Status\n" +
      "TEAMREF,MAC Member,Ada,Lovelace,ADA@Gmail.com ,Complete\n" +
      "TEAMREF,MAC Member,Alan,Turing,buyer@x.org,Complete\n";
    const list = await new CsvTicketSource(csv).fetchTickets({} as Event);
    expect(list).toHaveLength(2);
    expect(list[0].orderReference).toBe("TEAMREF");
    expect(list[1].orderReference).toBe("TEAMREF");
    expect(list[0].humanitixTicketId).not.toBe(list[1].humanitixTicketId);
    expect(list[0].attendeeEmailNormalised).toBe("ada@gmail.com");
    expect(list[0].status).toBe("complete");
  });

  it("defaults missing status to complete (attendee exports list valid attendees)", async () => {
    const csv = "Order #,Ticket Type,First Name,Last Name,Email\nABCD,General,Grace,Hopper,g@x.io\n";
    const [t] = await new CsvTicketSource(csv).fetchTickets({} as Event);
    expect(t.status).toBe("complete");
  });
});
