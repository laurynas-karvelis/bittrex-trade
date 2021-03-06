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
        this.log = [];

        function hasKey(o, key) {
            return typeof o == 'object' && o.constructor == Object && o.hasOwnProperty(key);
        }
    }

    _log(eventMsg) {
        this.log.push({t: new Date, e: eventMsg});
    }

    markAsComplete() {
        // consider trade complete as the requirements are fulfilled
        this.isComplete = true;
        this.emit('trade-complete');
        this._log('Marked as complete trade');
    }

    async execute() {
        let uuid;
        const {quantity, rate} = await this._gerOrderQuantityAndRate();

        if (quantity.lte(0) || rate.lte(0)) {
            // not needed to even open an order, mark this trade as complete
            quantity.lte(0) && this._log('Execution quantity was 0');
            rate.lte(0) && this._log('Execution rate was 0');
            return this.markAsComplete();
        }

        // actually place the order and wait
        try {
            this._log(`Placing order of ${quantity.toFixed()} @ ${rate.toFixed()}`);
            uuid = await this._privateApi[this._orderMethodName](this.market, quantity.toNumber(), rate.toNumber());
        } catch (e) {
            this._log(`Captured an exception "${e.message}"`);
            if (e.message === 'MIN_TRADE_REQUIREMENT_NOT_MET' || e.message.includes('DUST_TRADE_DISALLOWED')) {
                // mark this trade as complete
                return this.markAsComplete();
            }

            // otherwise throw
            throw e;
        }

        // allow order to be filled as much as reasonably possible within the given time constrain
        await Promise.delay(this.orderFulfillTimeLimit);
        const order = await this._closeOrder(uuid);
        this._registerOrder(order);

        // someone might find this useful if verbosity is needed on each iteration
        this._log(`End of current trade iteration`);
        this.emit('order-iteration-complete', order);

        // lets recurse
        return this.execute();
    }

    async _closeOrder(uuid) {
        this._log(`Closing order ${uuid}`);
        const order = await this._privateApi.order(uuid);

        if (!order.IsOpen) {
            // order is already closed
            this._log('Order is not open');
            return order;
        }

        // cancel the order
        try {
            this._log('Invoking order cancellation');
            await this._privateApi.cancel(uuid);

            // after order cancellation is requested, lets wait a bit and re-fetch order data again
            // a delay before re-fetch is needed as Bittrex not always able to cancel orders immediately
            await Promise.delay(this.refetchOrderOnCancellationAfter);
        } catch (e) {
            // ORDER_NOT_OPEN means this order got fulfilled just earlier before us cancelling it
            this._log(`Order cancellation exception "${e.message}"`);
            if (e.message !== 'ORDER_NOT_OPEN') throw e;
        }

        // recurse
        return this._closeOrder(uuid);
    }

    _registerOrder(order) {
        this._log(`Registering the order ${order.Uuid}`);
        this.executedOrders.push(order);

        const executedRate = order.PricePerUnit;
        const executedQuantity = order.Quantity.minus(order.QuantityRemaining);
        const executedBaseQuantity = executedQuantity.times(executedRate);

        if (executedQuantity.gt(0)) {
            this._log(`Executed quantity of ${order.Uuid} was ${executedQuantity.toFixed()} @ ${executedRate.toFixed()} rate`);
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
        this._log(`Calculated 85th percentile is ${percentile85}`);

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
            'executedBaseQuantities', 'executedQuantities', 'log'
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
