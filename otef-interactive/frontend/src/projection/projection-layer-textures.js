const SCENE_IDS = new Set(['image', 'map', 'settlements', 'caption', 'pattern', 'legend']);

function dimensions(source) {
  if (source?.complete === false) return null;
  const image = 'naturalWidth' in Object(source) || 'naturalHeight' in Object(source);
  const width = image ? source.naturalWidth : source?.width;
  const height = image ? source.naturalHeight : source?.height;
  return Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0
    ? { width, height } : null;
}

export function createProjectionLayerTextures(gl) {
  const records = new Map();

  return {
    bind(layer) {
      if (!SCENE_IDS.has(layer.id)) throw new Error(`unsupported projection scene layer: ${layer.id}`);
      const size = dimensions(layer.source);
      if (!size) {
        const existing = records.get(layer.id);
        if (existing) existing.valid = false;
        return null;
      }
      let record = records.get(layer.id);
      if (!record) {
        const texture = gl.createTexture();
        if (!texture) throw new Error('projection layer texture allocation failed');
        record = { texture, source: null, width: 0, height: 0, version: null, valid: false };
        records.set(layer.id, record);
        try {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        } catch (error) {
          records.delete(layer.id);
          gl.deleteTexture?.(texture);
          throw error;
        }
      } else {
        gl.bindTexture(gl.TEXTURE_2D, record.texture);
      }
      const versioned = Number.isSafeInteger(layer.contentVersion) && layer.contentVersion >= 0;
      const upload = !record.valid || !versioned || record.source !== layer.source ||
        record.width !== size.width || record.height !== size.height || record.version !== layer.contentVersion;
      if (upload) {
        record.valid = false;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.source);
        Object.assign(record, { valid: true, source: layer.source, width: size.width,
          height: size.height, version: layer.contentVersion });
      }
      return record.texture;
    },
    prune(ids) {
      for (const [id, record] of records) {
        if (ids.has(id)) continue;
        gl.deleteTexture?.(record.texture);
        records.delete(id);
      }
    },
    dispose() {
      for (const record of records.values()) gl.deleteTexture?.(record.texture);
      records.clear();
    },
  };
}
