import React from 'react';

const TableComponent = ({ data }) => {
  if (!data || !data.indicators) {
    console.log("No data available");
    return null; 
  }

  const getBlueScaleColor = (value) => {
    const minColorValue = 0; 
    const maxColorValue = 100; 
    const saturation = 80;

    const hue = 240 - Math.round((value - minColorValue) / (maxColorValue - minColorValue) * 120); // Adjust 120 as needed
    const lightness = 50; 

    const rgbColor = hslToRgb(hue, saturation, lightness);

    return `rgb(${rgbColor[0]}, ${rgbColor[1]}, ${rgbColor[2]})`;
  };

  const hslToRgb = (h, s, l) => {
    h /= 360;
    s /= 100;
    l /= 100;

    let r, g, b;

    if (s === 0) {
      r = g = b = l; 
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;

      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }

    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  };

  const columnTotals = data.indicators.map((indicator, index) => {
    const total = data.cities.reduce((sum, city) => sum + city.values[index], 0);
    return total;
  });

  return (
    <table>
      <thead>
        <tr>
          <th>Cities</th>
          {data.indicators.map((indicator, index) => (
            <th key={index}>{indicator}</th>
          ))}
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {data.cities.map((city, cityIndex) => (
          <tr key={cityIndex}>
            <td>{city.name}</td>
            {city.values.map((value, valueIndex) => (
              <td key={valueIndex} style={{ backgroundColor: getBlueScaleColor(value) }}>{value}</td>
            ))}
            <td>{columnTotals[cityIndex]}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          {columnTotals.map((total, index) => (
            <td key={index}>{total}</td>
          ))}
          <td>{columnTotals.reduce((sum, total) => sum + total, 0)}</td>
        </tr>
      </tfoot>
    </table>
  );
};

export default TableComponent;