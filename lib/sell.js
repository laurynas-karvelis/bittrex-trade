const Trade = require('./trade');

class Sell extends Trade {
    constructor(market, quantity, api, options = {}) {
        super(market, quantity, api);

        this._orderMethodName = 'sellLimit';
        this.orderFulfillTimeLimit = options.orderFulfillTimeLimit || 10 * 1000;
        this.refetchOrderOnCancellationAfter = options.refetchOrderOnCancellationAfter || 1000;
    }

    async _gerOrderQuantityAndRate() {
        const ticker = await this._privateApi.ticker(this.market);

        const rate = ticker.Ask;
        const remainingQuantity = this.quantity.minus(this.getExecutedQuantity());
        const quantity = await this._adjustQuantity(remainingQuantity, 'buy');

        return {quantity, rate};
    }
}

module.exports = Sell;
