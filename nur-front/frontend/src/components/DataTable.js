import React from 'react';

const ProgressBar = ({ percentage }) => {
  let color = '';
  if (percentage <= 33) {
    color = 'red'; // color for range 0-33%
  } else if (percentage <= 66) {
    color = 'yellow'; // color for range 34-66%
  } else {
    color = 'green'; // color for range 67-100%
  }

  const progressStyle = {
    width: `${percentage}%`,
    backgroundColor: color,
    height: '20px',
  };

  return <div style={progressStyle}></div>;
};

const TableComponent = ({ data }) => {
  return (
    <table>
      <thead>
        <tr>
          <th>Category</th>
          <th>Number</th>
        </tr>
      </thead>
      <tbody>
        {data.categories.map((category, index) => (
          <React.Fragment key={index}>
            <tr>
              <td>{category.name}</td>
              <td>{category.indicators.indicator1}</td>
            </tr>
            <tr>
              <td colSpan="2">
                <ProgressBar percentage={category.indicators.indicator1} />
              </td>
            </tr>
            <tr>
              <td>{category.name}</td>
              <td>{category.indicators.indicator2}</td>
            </tr>
            <tr>
              <td colSpan="2">
                <ProgressBar percentage={category.indicators.indicator2} />
              </td>
            </tr>
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
};

export default TableComponent;