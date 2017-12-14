const EventEmitter = require('events'),
    BigNumber = require('bignumber.js'),
    stats = require('stats-lite'),
    Promise = require('bluebird');

class Trade extends EventEmitter {
    constructor(market, quantity, api) {
        super();
        this._privateApi = hasKey(api, 'privateApi') ? api.privateApi : api;
        this._publicApi = hasKey(api, 'publicApi') ? api.publicApi : null;

        this.isComplete = false;
        this.market = market;
        this.quantity = new BigNumber(quantity);

        this.executedOrders = [];
        this.executedRates = [];
        this.executedBaseQuantities = [];
        this.executedQuantities = [];

        function hasKey(o, key) {
            return typeof o == 'object' && o.constructor == Object && o.hasOwnProperty(key);
        }
    }

    async execute() {
        let uuid;
        const {quantity, rate} = await this._gerOrderQuantityAndRate();

        // actually place the order and wait
        try {
            uuid = await this._privateApi[this._orderMethodName](this.market, quantity.toNumber(), rate.toNumber());
        } catch (e) {
            if (
                e.message === 'MIN_TRADE_REQUIREMENT_NOT_MET' ||
                e.message.includes('DUST_TRADE_DISALLOWED') ||
                (e.message === 'QUANTITY_NOT_PROVIDED' && quantity.eq(0))
            ) {
                // consider trade complete as we hit minimal purchasable quantity limit
                this.isComplete = true;
                this.emit('trade-complete');

                // done.
                return;
            }

            // otherwise throw
            throw e;
        }

        // allow order to be filled as much as reasonably possible within the given time constrain
        await Promise.delay(this.orderFulfillTimeLimit);
        const order = await this._closeOrder(uuid);
        this._registerOrder(order);

        // someone might find this useful if verbosity is needed on each iteration
        this.emit('order-iteration-complete', order);

        // lets recurse
        return this.execute();
    }

    async _closeOrder(uuid) {
        const order = await this._privateApi.order(uuid);

        if (!order.IsOpen) {
            // order is already closed
            return order;
        }

        // cancel the order
        try {
            await this._privateApi.cancel(uuid);

            // after order cancellation is requested, lets wait a bit and re-fetch order data again
            // a delay before re-fetch is needed as Bittrex not always able to cancel orders immediately
            await Promise.delay(this.refetchOrderOnCancellationAfter);
        } catch (e) {
            // ORDER_NOT_OPEN means this order got fulfilled just earlier before us cancelling it
            if (e.message !== 'ORDER_NOT_OPEN') throw e;
        }

        // recurse
        return this._closeOrder(uuid);
    }

    _registerOrder(order) {
        this.executedOrders.push(order);

        const executedRate = order.PricePerUnit;
        const executedQuantity = order.Quantity.minus(order.QuantityRemaining);
        const executedBaseQuantity = executedQuantity.times(executedRate);

        if (executedQuantity.gt(0)) {
            this.executedRates.push(executedRate);
            this.executedQuantities.push(executedQuantity);
            this.executedBaseQuantities.push(executedBaseQuantity);
        }
    }

    async _adjustQuantity(quantity, orderbookType) {
        if (!this._publicApi) return quantity;

        // analyse the orderbook and find 85th percentile quantity value
        const orderBook = await this._publicApi.getOrderBook(this.market, 10, orderbookType);
        const percentile85 = stats.percentile(orderBook.map(item => item.Quantity), 0.85);

        // lets not bring too much attention so the price
        // wouldn't start fluctuating rapidly to our disfavour
        return quantity.gt(percentile85) ? new BigNumber(percentile85) : quantity;
    }

    getExecutedOrders() {
        return this.executedOrders;
    }

    getExecutedBaseQuantity() {
        return new BigNumber(this.executedBaseQuantities.reduce((sum, n) => n.add(sum), 0));
    }

    getExecutedQuantity() {
        return new BigNumber(this.executedQuantities.reduce((sum, n) => n.add(sum), 0));
    }

    getExecutedMeanRate() {
        if (!this.executedRates.length) {
            return NaN;
        }

        const acc = this.executedRates.reduce((sum, n) => n.add(sum), 0);
        return acc.div(this.executedRates.length);
    }

    toJSON() {
        const obj = {};
        const keys = [
            'isComplete', 'market', 'executedOrders', 'executedRates',
            'executedBaseQuantities', 'executedQuantities'
        ];

        const executedMeanRate = this.getExecutedMeanRate();
        keys.forEach(key => obj[key] = this[key]);

        return Object.assign(obj, {
            quantity: this.quantity.toJSON(),
            executedBaseQuantity: this.getExecutedBaseQuantity().toJSON(),
            executedQuantity: this.getExecutedQuantity().toJSON(),
            executedMeanRate: isNaN(executedMeanRate) ? executedMeanRate : executedMeanRate.toJSON()
        });
    }
}

module.exports = Trade;
