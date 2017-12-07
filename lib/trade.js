const EventEmitter = require('events'),
    BigNumber = require('bignumber.js'),
    Promise = require('bluebird');

class Trade extends EventEmitter {
    constructor(market, quantity, api) {
        super();
        this.api = api;
        this.isComplete = false;

        this.market = market;
        this.quantity = new BigNumber(quantity);

        this.executedOrders = [];
        this.executedRates = [];
        this.executedBaseQuantities = [];
        this.executedQuantities = [];
    }

    async execute() {
        let uuid;
        const {quantity, rate} = await this._gerOrderQuantityAndRate();

        // actually place the order and wait
        try {
            uuid = await this.api[this._orderMethodName](this.market, quantity, rate);
        } catch (e) {
            if (e.message === 'MIN_TRADE_REQUIREMENT_NOT_MET') {
                // consider trade complete as we hit minimal purchasable quantity limit
                this.isComplete = true;
                this.emit('trade-complete');

                // done.
                return;
            }

            // otherwise throw
            throw e;
        }

        // allow order to be filled as much as reasonably possible within the given time constrains
        await Promise.delay(this.orderFulfillTimeLimit);
        const order = await this._closeOrder(uuid);
        this._registerOrder(order);

        // someone might find this useful if verbosity is needed
        this.emit('order-iteration-complete', order);

        // lets recurse
        return this.execute();
    }

    async _closeOrder(uuid) {
        const order = await this.api.order(uuid);

        // decide what to do next with this order
        if (!order.IsOpen) {
            // order is closed / fulfilled completely
            return order;
        } else {
            // order is completely or partially unfulfilled, cancel it
            try {
                await this.api.cancel(uuid);

                // once cancelled and after a cool-down lets refetch cancelled order's details again
                // this is needed as sometimes Bittrex fails to cancel the order immediately
                await Promise.delay(this.refetchOrderOnCancellationAfter);
            } catch (e) {
                // ORDER_NOT_OPEN means it's already fully fulfilled
                if (e.message !== 'ORDER_NOT_OPEN') throw e;
            }

            return this._closeOrder(uuid);
        }
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
