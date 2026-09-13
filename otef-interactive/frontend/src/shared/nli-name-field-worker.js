import { createNameFieldGeometry, buildNliNameField } from './nli-name-field-geometry.js';

self.onmessage = ({data}) => {
  try {
    const geometry = createNameFieldGeometry(data.geometry);
    const widths = new Map(data.widths);
    const field = buildNliNameField(data.collection, geometry, {
      fontSizes: [...widths.keys()],
      datasetVersion: data.datasetVersion,
      measureText: (name,size) => widths.get(size).get(name),
    });
    self.postMessage({field});
  } catch(error) {
    self.postMessage({error:error.message});
  }
};
