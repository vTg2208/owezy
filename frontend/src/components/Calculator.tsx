import { useState } from 'react';

interface CalculatorProps {
  onUseValue?: (value: string) => void;
}

export default function Calculator({ onUseValue }: CalculatorProps) {
  const [display, setDisplay] = useState('0');
  const [previousValue, setPreviousValue] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [isNewNumber, setIsNewNumber] = useState(true);

  const handleNumber = (num: string) => {
    if (isNewNumber) {
      setDisplay(num);
      setIsNewNumber(false);
    } else {
      setDisplay(display === '0' ? num : display + num);
    }
  };

  const handleDecimal = () => {
    if (isNewNumber) {
      setDisplay('0.');
      setIsNewNumber(false);
    } else if (!display.includes('.')) {
      setDisplay(display + '.');
    }
  };

  const handleOperation = (op: string) => {
    if (previousValue !== null && operation !== null && !isNewNumber) {
      calculate();
    }
    setPreviousValue(display);
    setOperation(op);
    setIsNewNumber(true);
  };

  const calculate = () => {
    if (previousValue === null || operation === null) return;

    const prev = parseFloat(previousValue);
    const current = parseFloat(display);
    let result = 0;

    switch (operation) {
      case '+':
        result = prev + current;
        break;
      case '-':
        result = prev - current;
        break;
      case '*':
        result = prev * current;
        break;
      case '/':
        result = current !== 0 ? prev / current : 0;
        break;
    }

    setDisplay(result.toString());
    setPreviousValue(null);
    setOperation(null);
    setIsNewNumber(true);
  };

  const clear = () => {
    setDisplay('0');
    setPreviousValue(null);
    setOperation(null);
    setIsNewNumber(true);
  };

  const handleUseValue = () => {
    if (onUseValue) {
      onUseValue(parseFloat(display).toFixed(2));
    }
  };

  const buttons = [
    ['7', '8', '9', '/'],
    ['4', '5', '6', '*'],
    ['1', '2', '3', '-'],
    ['0', '.', '=', '+'],
  ];

  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
      <div className="bg-white rounded px-3 py-2 mb-3 text-right border border-gray-300">
        <div className="text-2xl font-mono font-semibold text-gray-800 truncate">
          {display}
        </div>
      </div>
      
      <div className="grid grid-cols-4 gap-2 mb-2">
        {buttons.flat().map((btn) => {
          const isOperation = ['+', '-', '*', '/'].includes(btn);
          const isEquals = btn === '=';
          
          return (
            <button
              key={btn}
              onClick={() => {
                if (btn === '=') {
                  calculate();
                } else if (btn === '.') {
                  handleDecimal();
                } else if (isOperation) {
                  handleOperation(btn);
                } else {
                  handleNumber(btn);
                }
              }}
              className={`py-3 rounded font-semibold transition ${
                isEquals
                  ? 'bg-green-500 text-white hover:bg-green-600'
                  : isOperation
                  ? 'bg-indigo-500 text-white hover:bg-indigo-600'
                  : 'bg-white border border-gray-300 text-gray-800 hover:bg-gray-100'
              }`}
            >
              {btn}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={clear}
          className="py-2 bg-red-500 text-white rounded font-semibold hover:bg-red-600 transition"
        >
          Clear
        </button>
        {onUseValue && (
          <button
            onClick={handleUseValue}
            className="py-2 bg-blue-500 text-white rounded font-semibold hover:bg-blue-600 transition"
          >
            Use Value
          </button>
        )}
      </div>
    </div>
  );
}
