import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';

import Users from '../../models/users.model';

@Table({
  tableName: 'SmsSyncStates',
  timestamps: true,
  freezeTableName: true,
})
export default class SmsSyncStates extends Model {
  @Column({
    type: DataType.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false,
  })
  declare id: number;

  @ForeignKey(() => Users)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    unique: true,
  })
  declare userId: number;

  @Column({
    type: DataType.BIGINT,
    allowNull: false,
    get() {
      return Number(this.getDataValue('latestSmsTimestamp'));
    },
  })
  declare latestSmsTimestamp: number;

  @BelongsTo(() => Users)
  declare user: Users;
}
