const Trade = require('./trade');

class Sell extends Trade {
    constructor(market, quantity, api, options = {}) {
        super(market, quantity, api);

        this._orderMethodName = 'sellLimit';
        this.orderFulfillTimeLimit = options.orderFulfillTimeLimit || 10 * 1000;
        this.refetchOrderOnCancellationAfter = options.refetchOrderOnCancellationAfter || 1000;
    }

    async _gerOrderQuantityAndRate() {
        const ticker = await this.api.ticker(this.market);

        const rate = ticker.Ask;
        const quantity = this.quantity.minus(this.getExecutedQuantity());

        return {quantity, rate};
    }
}

module.exports = Sell;
