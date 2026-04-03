import { Entity, Column, CreateDateColumn, Index, PrimaryGeneratedColumn } from 'typeorm'
import { IFlowVersionTag } from '../../Interface'

type EntityType = 'CHATFLOW' | 'ASSISTANT'

@Entity()
@Index(['entityType', 'entityId', 'tagName'], { unique: true })
@Index(['historyId'])
export class FlowVersionTag implements IFlowVersionTag {
    @PrimaryGeneratedColumn('uuid')
    id: string

    @Column({ type: 'varchar', length: 20 })
    entityType: EntityType

    @Column({ type: 'uuid' })
    entityId: string

    @Column({ type: 'uuid' })
    historyId: string

    @Column({ type: 'varchar', length: 100 })
    tagName: string

    @Column({ nullable: true, type: 'text' })
    description?: string

    @Column({ type: 'text' })
    createdById: string

    @Column({ type: 'text' })
    createdByName: string

    @Column({ type: 'timestamp' })
    @CreateDateColumn()
    createdDate: Date

    @Column({ type: 'text' })
    workspaceId: string
}
