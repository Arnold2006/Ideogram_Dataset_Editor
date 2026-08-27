const HEX_COLOR = { type: "string", pattern: "^#[0-9A-F]{6}$" };
const STYLE_PALETTE = { type: "array", items: HEX_COLOR, minItems: 1, maxItems: 16 };
const ELEMENT_PALETTE = { type: "array", items: HEX_COLOR, minItems: 1, maxItems: 5 };
const BBOX = { type: "array", items: { type: "integer", minimum: 0, maximum: 1000 }, minItems: 4, maxItems: 4 };
const IDEOGRAM_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Ideogram 4 JSON caption",
  type: "object",
  additionalProperties: false,
  required: ["compositional_deconstruction"],
  properties: {
    high_level_description: { type: "string", minLength: 1 },
    style_description: {
      type: "object",
      oneOf: [
        {
          additionalProperties: false,
          required: ["aesthetics", "lighting", "photo", "medium"],
          properties: {
            aesthetics: { type: "string", minLength: 1 },
            lighting: { type: "string", minLength: 1 },
            photo: { type: "string", minLength: 1 },
            medium: { const: "photograph" },
            color_palette: STYLE_PALETTE
          }
        },
        {
          additionalProperties: false,
          required: ["aesthetics", "lighting", "medium", "art_style"],
          properties: {
            aesthetics: { type: "string", minLength: 1 },
            lighting: { type: "string", minLength: 1 },
            medium: { type: "string", minLength: 1, not: { const: "photograph" } },
            art_style: { type: "string", minLength: 1 },
            color_palette: STYLE_PALETTE
          }
        }
      ]
    },
    compositional_deconstruction: {
      type: "object",
      additionalProperties: false,
      required: ["background", "elements"],
      properties: {
        background: { type: "string", minLength: 1 },
        elements: {
          type: "array",
          minItems: 1,
          items: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["type", "desc"],
                properties: {
                  type: { const: "obj" },
                  bbox: BBOX,
                  desc: { type: "string", minLength: 1 },
                  color_palette: ELEMENT_PALETTE
                }
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["type", "text", "desc"],
                properties: {
                  type: { const: "text" },
                  bbox: BBOX,
                  text: { type: "string", minLength: 1 },
                  desc: { type: "string", minLength: 1 },
                  color_palette: ELEMENT_PALETTE
                }
              }
            ]
          }
        }
      }
    }
  }
};
const KEY_ORDER = {
  top: ["high_level_description", "style_description", "compositional_deconstruction"],
  stylePhoto: ["aesthetics", "lighting", "photo", "medium", "color_palette"],
  styleArt: ["aesthetics", "lighting", "medium", "art_style", "color_palette"],
  composition: ["background", "elements"],
  elementObj: ["type", "bbox", "desc", "color_palette"],
  elementText: ["type", "bbox", "text", "desc", "color_palette"]
};
const LIMITS = {
  stylePaletteMax: 16,
  elementPaletteMax: 5,
  bboxMin: 0,
  bboxMax: 1000
};
module.exports = { IDEOGRAM_SCHEMA, KEY_ORDER, LIMITS };
