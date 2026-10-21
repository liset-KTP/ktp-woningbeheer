import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Bescherming tegen browser-vertaling (Google Translate / Chrome "Pagina vertalen").
// Translate vervangt tekst-nodes in de pagina door eigen <font>-elementen. Als React daarna
// zo'n node wil verwijderen of ervoor iets wil invoegen, bestaat die niet meer op de
// verwachte plek -> "NotFoundError: removeChild ..." en de hele app crasht.
// Huismeester Cristian gebruikt de app met Chrome-vertaling naar het Roemeens; dit voorkomt
// dat de app crasht bij bv. het afvinken van een checkpunt in de woningcontrole.
// Bekende workaround: https://github.com/facebook/react/issues/11538
if (typeof Node === 'function' && Node.prototype) {
  const origRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (child.parentNode !== this) {
      if (child.parentNode) return origRemoveChild.call(child.parentNode, child);
      return child;
    }
    return origRemoveChild.apply(this, arguments);
  };
  const origInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) {
      return origInsertBefore.call(this, newNode, null);
    }
    return origInsertBefore.apply(this, arguments);
  };
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);
