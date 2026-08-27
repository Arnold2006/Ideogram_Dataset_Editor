export function createAppState(){
  return {
    folder: null,
    dataset: [],
    current: 0,
    modified: new Set(),
    photoArtMode: {},
    selectedIdx: null
  };
}
