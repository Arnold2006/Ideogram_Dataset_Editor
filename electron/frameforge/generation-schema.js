const HEX_COLOR = { type: "string", minLength: 7, maxLength: 7 };
const BBOX = {
  type: "object",
  required: ["y_min", "x_min", "y_max", "x_max"],
  properties: {
    y_min: { type: "integer" },
    x_min: { type: "integer" },
    y_max: { type: "integer" },
    x_max: { type: "integer" }
  }
};
const GENERATION_SCHEMA = {
  type: "object",
  required: ["high_level_description", "style_description", "compositional_deconstruction"],
  properties: {
    high_level_description: { type: "string", minLength: 1 },
    style_description: {
      oneOf: [
        {
          type: "object",
          required: ["aesthetics", "lighting", "photo", "medium", "color_palette"],
          properties: {
            aesthetics: { type: "string", minLength: 1 },
            lighting:   { type: "string", minLength: 1 },
            photo:      { type: "string", minLength: 1 },
            medium:     { const: "photograph" },
            color_palette: { type: "array", items: HEX_COLOR, minItems: 1, maxItems: 16 }
          }
        },
        {
          type: "object",
          required: ["aesthetics", "lighting", "medium", "art_style", "color_palette"],
          properties: {
            aesthetics: { type: "string", minLength: 1 },
            lighting:   { type: "string", minLength: 1 },
            medium:     { type: "string", minLength: 1 },
            art_style:  { type: "string", minLength: 1 },
            color_palette: { type: "array", items: HEX_COLOR, minItems: 1, maxItems: 16 }
          }
        }
      ]
    },
    compositional_deconstruction: {
      type: "object",
      required: ["background", "elements"],
      properties: {
        background: { type: "string", minLength: 1 },
        elements: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: {
            oneOf: [
              {
                type: "object",
                required: ["type", "bbox", "desc", "color_palette"],
                properties: {
                  type: { const: "obj" },
                  bbox: BBOX,
                  desc: { type: "string", minLength: 1 },
                  color_palette: { type: "array", items: HEX_COLOR, minItems: 1, maxItems: 5 }
                }
              },
              {
                type: "object",
                required: ["type", "bbox", "text", "desc", "color_palette"],
                properties: {
                  type: { const: "text" },
                  bbox: BBOX,
                  text: { type: "string", minLength: 1 },
                  desc: { type: "string", minLength: 1 },
                  color_palette: { type: "array", items: HEX_COLOR, minItems: 1, maxItems: 5 }
                }
              }
            ]
          }
        }
      }
    }
  }
};
module.exports = { GENERATION_SCHEMA };
