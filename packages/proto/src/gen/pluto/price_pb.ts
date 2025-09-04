// Pre-generated minimal protobuf messages for PriceService
import { Message, proto3 } from "@bufbuild/protobuf";

export class SubscribeRequest extends Message<SubscribeRequest> {
  ticker = "";
  constructor(data?: Partial<SubscribeRequest>) {
    super();
    if (data) {
      if (data.ticker !== undefined) this.ticker = data.ticker;
    }
  }
  static readonly runtime: typeof proto3 = proto3;
  static readonly typeName = "pluto.SubscribeRequest";
  static readonly fields = proto3.util.newFieldList(() => [
    { no: 1, name: "ticker", kind: "scalar", T: 9 /* string */ },
  ]);
  // Minimal JSON helpers expected by ConnectRPC
  static fromJson(jsonValue: unknown): SubscribeRequest {
    const obj = (jsonValue ?? {}) as any;
    return new SubscribeRequest({ ticker: obj.ticker ?? "" });
  }
  static fromJsonString(json: string): SubscribeRequest {
    return this.fromJson(JSON.parse(json));
  }
  static equals(a: SubscribeRequest | { ticker?: string }, b: SubscribeRequest | { ticker?: string }): boolean {
    const ta = (a as any)?.ticker ?? "";
    const tb = (b as any)?.ticker ?? "";
    return ta === tb;
  }
}

export class PriceUpdate extends Message<PriceUpdate> {
  ticker = "";
  price = 0;
  isoTime = "";
  constructor(data?: Partial<PriceUpdate>) {
    super();
    if (data) {
      if (data.ticker !== undefined) this.ticker = data.ticker;
      if (data.price !== undefined) this.price = data.price;
      if (data.isoTime !== undefined) this.isoTime = data.isoTime;
    }
  }
  static readonly runtime: typeof proto3 = proto3;
  static readonly typeName = "pluto.PriceUpdate";
  static readonly fields = proto3.util.newFieldList(() => [
    { no: 1, name: "ticker", kind: "scalar", T: 9 /* string */ },
    { no: 2, name: "price", kind: "scalar", T: 1 /* double */ },
    { no: 3, name: "isoTime", kind: "scalar", T: 9 /* string */ },
  ]);
  // Minimal JSON helpers expected by ConnectRPC
  static fromJson(jsonValue: unknown): PriceUpdate {
    const obj = (jsonValue ?? {}) as any;
    return new PriceUpdate({
      ticker: obj.ticker ?? "",
      price: typeof obj.price === "number" ? obj.price : Number(obj.price ?? 0),
      isoTime: obj.isoTime ?? "",
    });
  }
  static fromJsonString(json: string): PriceUpdate {
    return this.fromJson(JSON.parse(json));
  }
  static equals(
    a: PriceUpdate | { ticker?: string; price?: number; isoTime?: string },
    b: PriceUpdate | { ticker?: string; price?: number; isoTime?: string }
  ): boolean {
    const aa: any = a ?? {};
    const bb: any = b ?? {};
    return (aa.ticker ?? "") === (bb.ticker ?? "") && Number(aa.price ?? 0) === Number(bb.price ?? 0) && (aa.isoTime ?? "") === (bb.isoTime ?? "");
  }
}
