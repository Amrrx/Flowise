import { Entity, Column, UpdateDateColumn, Index, PrimaryGeneratedColumn } from 'typeorm'
import { IFlowDraft } from '../../Interface'

@Entity()
@Index(['entityId', 'userId'], { unique: true })
export class FlowDraft implements IFlowDraft {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Column({ type: 'uuid' })
    entityId: string

    @Column({ type: 'text' })
    userId: string

    @Column({ type: 'text' })
    draftData: string

    @Column({ nullable: true, type: 'int' })
    basedOnVersion?: number

    @Column({ type: 'timestamp' })
    @UpdateDateColumn()
    updatedDate: Date

    @Column({ type: 'text' })
    workspaceId: string
}
