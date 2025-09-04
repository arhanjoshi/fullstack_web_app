import { MethodKind, type ServiceType } from "@bufbuild/protobuf";
import { PriceUpdate, SubscribeRequest } from "./price_pb";

export const PriceService = {
  typeName: "pluto.PriceService",
  methods: {
    subscribeTicker: {
      name: "SubscribeTicker",
      I: SubscribeRequest,
      O: PriceUpdate,
      kind: MethodKind.ServerStreaming,
    },
  },
} as const as unknown as ServiceType;

export type PriceServiceDefinition = typeof PriceService;
