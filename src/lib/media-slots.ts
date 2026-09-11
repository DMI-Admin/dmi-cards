export const modernMinimalMediaSlots = {
  profile: {
    aspectRatio: 1,
    outputWidth: 512,
    outputHeight: 512,
    fitMode: "cover",
  },
  logo: {
    aspectRatio: 1,
    outputWidth: 512,
    outputHeight: 512,
    fitMode: "cover",
  },
  banner: {
    aspectRatio: 3,
    outputWidth: 1500,
    outputHeight: 500,
    fitMode: "contain",
  },
} as const;

export type MediaCropFitMode =
  (typeof modernMinimalMediaSlots)[keyof typeof modernMinimalMediaSlots]["fitMode"];
