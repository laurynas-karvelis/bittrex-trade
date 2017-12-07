# bittrex-trade
Bittrex.com Limit Buy and Sell classes that retry a trade until entire required quantity is filled.

## Synopsis

``bittrex-trade`` module exposes two JS, ES6, promise and EventEmitter based classes that implement a trading strategy to **buy** or **sell** the entire given quantity of currency for provided market.
This module is built to work seamlessly with easy to use and fully featured [bittrex-promised-api](https://github.com/laurynas-karvelis/bittrex-promised-api) module.

Following features:
* Bluebird promise based
* Uses ES6 async/await syntax
* Uses BigNumber.js module to for precision calculations
* Buys the entire provided quantity in base currency at market rate
* Sells the entire provided quantity in secondary currency at market rate
* Opens the orders, observes their situation, cancels unfulfilled orders and retries at new market rates if needed
* Stores all executed orders' data inside the object, aggregates base market quantities purchased/sold, aggregates secondary currency purchased/sold quantities
* Stores all rates for orders that were fully or partially filled
* Calculates mean rate value from stored executed rates

## Code Example

Example usage of this module:
```javascript 1.6
const {PrivateApi} = require('bittrex-promised-api');
const {Buy, Sell} = require('bittrex-trade');
const privateApi = new PrivateApi('key', 'secret');


// to buy NEO coins worth of 0.5 BTC
const buy = new Buy('BTC-NEO', 0.5, privateApi);

// before executing a trade you can tap into a few exposed events
buy.on('order-iteration-complete', (order) => {
    // this will be called after every executed order
    // order data will be provided too, you can use this even listener
    // for more verbose logging, trade sync with db etc...
    console.log(order);
});

buy.on('trade-complete', () => {
    // another way bittrex-trade tells about complete trade
    // some listener can do some async off-promise-chain logic here 
});

// now execute the trade
buy.execute()
    .then(() => {
        console.log(buy.isComplete);
    
        console.log(buy.getExecutedOrders());   
        console.log(buy.getExecutedBaseQuantity());   
        console.log(buy.getExecutedQuantity());   
        console.log(buy.getExecutedMeanRate()); 
        console.log(buy.executedRates, buy.executedOrders, buy.executedBaseQuantities, buy.executedQuantities);
    
        // use this to persist buy trade information like rates, quantities, orders
        console.log(buy.toJSON());
    })
    .catch(console.error);


// to sell 200 NEO coins..
const sell = new Sell('BTC-NEO', 200, privateApi);

// Sell instances share same events as both Buy and Sell classes are children of Trade Class
sell.on('order-iteration-complete', (order) => {});
sell.on('trade-complete', () => {});

// actually execute the trade
sell.execute()
    .then(() => {
        // your code here once done
    })
    .catch(console.error);
```

## Motivation

To open a single limitBuy or limitSell call is easy peasy, although once it comes to actually purchase or sell larger quantities of particular currency isn't that straightforward.
Hence this module exists. It implements a simple order execution strategy that buys/sells at current market rates and if unfulfilled or partially filled it will cancel current order and will re-open a new order at updated market rate with updated remaining quantity automatically.
This way you can be sure that a required quantity to be traded ASAP at relatively good price will be fully executed.

## Installation

To install this module using yarn package manager invoke the following line in your project's working directory.
```
$ yarn add bittrex-trade
```

Or using npm:
```
$ npm install bittrex-trade
```

## Tests

Currently there are no tests, but pull requests are always welcome.

## License

MIT license. As in, do what you want, use it where you want.

